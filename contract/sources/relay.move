module patchway::relay;

use sui::event;
use sui::sui::SUI;
use sui::coin::Coin;
use std::string::String;
use patchway::channel::Channel;
use patchway::channel::Config;

const STATUS_PENDING: u8 = 0;
const STATUS_ACCEPTED: u8 = 1;
const STATUS_COMPLETED: u8 = 2;
const STATUS_EXPIRED: u8 = 3;

const RELAY_FEE: u64 = 10_000_000;
const TREASURY: address = @0x2717627095bc5e7ff69cbe86938ccb5e57fcd485116ff3328e05494da01b0068;

// v4.2 — time-bounded expiry window for `expire_relay_timed`. A pending/accepted
// relay can be force-expired by either party once this many epochs have elapsed
// since creation. `cancel_relay` is the untimed either-party path.
const RELAY_TIMEOUT_EPOCHS: u64 = 7;

#[error]
const ENotOwner: vector<u8> = b"Caller is not the channel owner";
#[error]
const EChannelInactive: vector<u8> = b"Sending channel is inactive";
#[error]
const EChannelMismatch: vector<u8> = b"Channel does not match relay destination";
#[error]
const EInvalidStatus: vector<u8> = b"Relay is not in the required status for this operation";
#[error]
const EInsufficientFee: vector<u8> = b"Coin value is less than the required relay fee";
// v4.2 — new error constants (additive)
#[error]
const EBadDigestHash: vector<u8> = b"digest_hash must be exactly 32 bytes (SHA-256)";
#[error]
const ETooEarly: vector<u8> = b"Relay timeout window has not yet elapsed";
#[error]
const EFeeBypassDisabled: vector<u8> = b"Fee-free create_relay is disabled; use create_relay_with_config";

public struct Relay has key, store {
    id: UID,
    from_channel: ID,
    to_channel: ID,
    from_memwal_account_id: ID,
    digest_blob_id: String,
    artifact_blob_ids: vector<String>,
    digest_hash: vector<u8>,
    memwal_namespace: String,
    status: u8,
    created_at: u64,
    accepted_at: Option<u64>,
    completed_at: Option<u64>,
    sender: address,
}

public struct RelayCreated has copy, drop {
    relay_id: ID,
    from_channel: ID,
    to_channel: ID,
    from_memwal_account_id: ID,
    digest_blob_id: String,
    memwal_namespace: String,
    sender: address,
    created_at: u64,
}

public struct RelayAccepted has copy, drop {
    relay_id: ID,
    from_channel: ID,
    to_channel: ID,
    accepted_by: address,
    accepted_at: u64,
}

public struct RelayCompleted has copy, drop {
    relay_id: ID,
    from_channel: ID,
    to_channel: ID,
    completed_by: address,
    completed_at: u64,
}

public struct RelayExpired has copy, drop {
    relay_id: ID,
    from_channel: ID,
    to_channel: ID,
    expired_at: u64,
}

public struct RelayFeeCollected has copy, drop {
    relay_id: ID,
    payer: address,
    amount: u64,
    treasury: address,
}

// ── v4.2 — verifiable access-window events (additive) ───────────────────────────
// These make the delegate-access lifecycle provable trustlessly from chain. The
// granted delegate public key is recorded on `RelayAccessGranted`; on revoke the
// same pubkey is recorded on `RelayAccessRevoked`. Anyone can then read the
// sender's MemWal account on-chain and confirm the key is gone → revocation proven.

public struct RelayAccessGranted has copy, drop {
    relay_id: ID,
    to_channel: ID,
    delegate_pubkey: vector<u8>,
    granted_at: u64,
}

public struct RelayAccessRevoked has copy, drop {
    relay_id: ID,
    delegate_pubkey: vector<u8>,
    revoked_at: u64,
}

public struct RelayCancelled has copy, drop {
    relay_id: ID,
    from_channel: ID,
    to_channel: ID,
    cancelled_by: address,
    at: u64,
}

// v4.2 (P2.2) — the fee-free path is GATED OFF to close the fee-bypass. Body
// changes are upgrade-compatible; the signature is byte-identical for back-compat.
// Callers must use `create_relay_with_config`. The parameters are intentionally
// left unused (prefixed `_`) — they are kept only to preserve the function ABI.
entry fun create_relay(
    _from_channel: &Channel,
    _to_channel_id: ID,
    _from_memwal_account_id: ID,
    _digest_blob_id: String,
    _artifact_blob_ids: vector<String>,
    _digest_hash: vector<u8>,
    _ctx: &mut TxContext,
) {
    abort EFeeBypassDisabled
}

entry fun create_relay_with_fee(
    from_channel: &Channel,
    to_channel_id: ID,
    from_memwal_account_id: ID,
    digest_blob_id: String,
    artifact_blob_ids: vector<String>,
    digest_hash: vector<u8>,
    fee: Coin<SUI>,
    ctx: &mut TxContext,
) {
    assert!(patchway::channel::owner(from_channel) == ctx.sender(), ENotOwner);
    assert!(patchway::channel::is_active(from_channel), EChannelInactive);
    assert!(fee.value() >= RELAY_FEE, EInsufficientFee);

    transfer::public_transfer(fee, TREASURY);

    let relay = Relay {
        id: object::new(ctx),
        from_channel: patchway::channel::channel_id(from_channel),
        to_channel: to_channel_id,
        from_memwal_account_id,
        digest_blob_id,
        artifact_blob_ids,
        digest_hash,
        memwal_namespace: patchway::channel::memwal_namespace(from_channel),
        status: STATUS_PENDING,
        created_at: ctx.epoch(),
        accepted_at: option::none(),
        completed_at: option::none(),
        sender: ctx.sender(),
    };

    event::emit(RelayFeeCollected {
        relay_id: object::id(&relay),
        payer: ctx.sender(),
        amount: RELAY_FEE,
        treasury: TREASURY,
    });
    event::emit(RelayCreated {
        relay_id: object::id(&relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        from_memwal_account_id,
        digest_blob_id: relay.digest_blob_id,
        memwal_namespace: relay.memwal_namespace,
        sender: ctx.sender(),
        created_at: relay.created_at,
    });
    transfer::share_object(relay);
}

// v4.1 — fee + treasury read from the on-chain Config instead of module constants,
// so they can be tuned via AdminCap without a redeploy. Additive: the hardcoded
// create_relay_with_fee above stays for back-compat.
entry fun create_relay_with_config(
    from_channel: &Channel,
    config: &Config,
    to_channel_id: ID,
    from_memwal_account_id: ID,
    digest_blob_id: String,
    artifact_blob_ids: vector<String>,
    digest_hash: vector<u8>,
    fee: Coin<SUI>,
    ctx: &mut TxContext,
) {
    assert!(patchway::channel::owner(from_channel) == ctx.sender(), ENotOwner);
    assert!(patchway::channel::is_active(from_channel), EChannelInactive);
    // P3.1 — enforce SHA-256 integrity (32 bytes) rather than leaving it advisory.
    assert!(digest_hash.length() == 32, EBadDigestHash);

    let required = patchway::channel::relay_fee(config);
    let treasury = patchway::channel::treasury(config);
    assert!(fee.value() >= required, EInsufficientFee);

    // P2.3 — split EXACTLY `required` to the treasury and return any change to the
    // sender, so overpayment is never lost. (Was: transfer the whole fee coin.)
    let mut fee = fee;
    let payment = fee.split(required, ctx);
    let amount = payment.value();
    transfer::public_transfer(payment, treasury);
    if (fee.value() > 0) {
        transfer::public_transfer(fee, ctx.sender());
    } else {
        fee.destroy_zero();
    };

    let relay = Relay {
        id: object::new(ctx),
        from_channel: patchway::channel::channel_id(from_channel),
        to_channel: to_channel_id,
        from_memwal_account_id,
        digest_blob_id,
        artifact_blob_ids,
        digest_hash,
        memwal_namespace: patchway::channel::memwal_namespace(from_channel),
        status: STATUS_PENDING,
        created_at: ctx.epoch(),
        accepted_at: option::none(),
        completed_at: option::none(),
        sender: ctx.sender(),
    };

    event::emit(RelayFeeCollected {
        relay_id: object::id(&relay),
        payer: ctx.sender(),
        amount,
        treasury,
    });
    event::emit(RelayCreated {
        relay_id: object::id(&relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        from_memwal_account_id,
        digest_blob_id: relay.digest_blob_id,
        memwal_namespace: relay.memwal_namespace,
        sender: ctx.sender(),
        created_at: relay.created_at,
    });
    transfer::share_object(relay);
}

entry fun accept_relay(
    relay: &mut Relay,
    to_channel: &Channel,
    ctx: &TxContext,
) {
    assert!(patchway::channel::owner(to_channel) == ctx.sender(), ENotOwner);
    assert!(relay.to_channel == patchway::channel::channel_id(to_channel), EChannelMismatch);
    assert!(relay.status == STATUS_PENDING, EInvalidStatus);

    relay.status = STATUS_ACCEPTED;
    relay.accepted_at = option::some(ctx.epoch());

    event::emit(RelayAccepted {
        relay_id: object::id(relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        accepted_by: ctx.sender(),
        accepted_at: ctx.epoch(),
    });
}

entry fun complete_relay(
    relay: &mut Relay,
    to_channel: &Channel,
    ctx: &TxContext,
) {
    assert!(patchway::channel::owner(to_channel) == ctx.sender(), ENotOwner);
    assert!(relay.to_channel == patchway::channel::channel_id(to_channel), EChannelMismatch);
    assert!(relay.status == STATUS_ACCEPTED, EInvalidStatus);

    relay.status = STATUS_COMPLETED;
    relay.completed_at = option::some(ctx.epoch());

    event::emit(RelayCompleted {
        relay_id: object::id(relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        completed_by: ctx.sender(),
        completed_at: ctx.epoch(),
    });
}

entry fun expire_relay(
    relay: &mut Relay,
    channel: &patchway::channel::Channel,
    ctx: &TxContext,
) {
    assert!(patchway::channel::channel_id(channel) == relay.from_channel || patchway::channel::channel_id(channel) == relay.to_channel, EChannelMismatch);
    assert!(patchway::channel::owner(channel) == ctx.sender(), ENotOwner);
    assert!(relay.status == STATUS_PENDING || relay.status == STATUS_ACCEPTED, EInvalidStatus);

    relay.status = STATUS_EXPIRED;
    relay.completed_at = option::some(ctx.epoch());

    event::emit(RelayExpired {
        relay_id: object::id(relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        expired_at: ctx.epoch(),
    });
}

// ── v4.2 — verifiable-access entry functions (additive) ─────────────────────────
// These mirror the existing accept/complete/expire asserts byte-for-byte but also
// record the granted delegate public key on-chain via the new access-window events.
// The legacy accept_relay/complete_relay/expire_relay stay untouched for back-compat.

entry fun accept_relay_v2(
    relay: &mut Relay,
    to_channel: &Channel,
    delegate_pubkey: vector<u8>,
    ctx: &TxContext,
) {
    assert!(patchway::channel::owner(to_channel) == ctx.sender(), ENotOwner);
    assert!(relay.to_channel == patchway::channel::channel_id(to_channel), EChannelMismatch);
    assert!(relay.status == STATUS_PENDING, EInvalidStatus);

    relay.status = STATUS_ACCEPTED;
    relay.accepted_at = option::some(ctx.epoch());

    event::emit(RelayAccepted {
        relay_id: object::id(relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        accepted_by: ctx.sender(),
        accepted_at: ctx.epoch(),
    });
    event::emit(RelayAccessGranted {
        relay_id: object::id(relay),
        to_channel: relay.to_channel,
        delegate_pubkey,
        granted_at: ctx.epoch(),
    });
}

entry fun complete_relay_v2(
    relay: &mut Relay,
    to_channel: &Channel,
    delegate_pubkey: vector<u8>,
    ctx: &TxContext,
) {
    assert!(patchway::channel::owner(to_channel) == ctx.sender(), ENotOwner);
    assert!(relay.to_channel == patchway::channel::channel_id(to_channel), EChannelMismatch);
    assert!(relay.status == STATUS_ACCEPTED, EInvalidStatus);

    relay.status = STATUS_COMPLETED;
    relay.completed_at = option::some(ctx.epoch());

    event::emit(RelayCompleted {
        relay_id: object::id(relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        completed_by: ctx.sender(),
        completed_at: ctx.epoch(),
    });
    event::emit(RelayAccessRevoked {
        relay_id: object::id(relay),
        delegate_pubkey,
        revoked_at: ctx.epoch(),
    });
}

// Either-party cancel — no time check (supersedes the untimed expire_relay).
// Records access revocation so a cancel of an accepted relay is provable too.
entry fun cancel_relay(
    relay: &mut Relay,
    channel: &Channel,
    delegate_pubkey: vector<u8>,
    ctx: &TxContext,
) {
    assert!(
        patchway::channel::channel_id(channel) == relay.from_channel
            || patchway::channel::channel_id(channel) == relay.to_channel,
        EChannelMismatch,
    );
    assert!(patchway::channel::owner(channel) == ctx.sender(), ENotOwner);
    assert!(relay.status == STATUS_PENDING || relay.status == STATUS_ACCEPTED, EInvalidStatus);

    relay.status = STATUS_EXPIRED;
    relay.completed_at = option::some(ctx.epoch());

    event::emit(RelayCancelled {
        relay_id: object::id(relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        cancelled_by: ctx.sender(),
        at: ctx.epoch(),
    });
    event::emit(RelayAccessRevoked {
        relay_id: object::id(relay),
        delegate_pubkey,
        revoked_at: ctx.epoch(),
    });
}

// Time-bounded expiry — callable by either party once RELAY_TIMEOUT_EPOCHS have
// elapsed since creation. Records access revocation.
entry fun expire_relay_timed(
    relay: &mut Relay,
    channel: &Channel,
    ctx: &TxContext,
) {
    assert!(
        patchway::channel::channel_id(channel) == relay.from_channel
            || patchway::channel::channel_id(channel) == relay.to_channel,
        EChannelMismatch,
    );
    assert!(patchway::channel::owner(channel) == ctx.sender(), ENotOwner);
    assert!(relay.status == STATUS_PENDING || relay.status == STATUS_ACCEPTED, EInvalidStatus);
    assert!(relay.created_at + RELAY_TIMEOUT_EPOCHS <= ctx.epoch(), ETooEarly);

    relay.status = STATUS_EXPIRED;
    relay.completed_at = option::some(ctx.epoch());

    event::emit(RelayExpired {
        relay_id: object::id(relay),
        from_channel: relay.from_channel,
        to_channel: relay.to_channel,
        expired_at: ctx.epoch(),
    });
    event::emit(RelayAccessRevoked {
        relay_id: object::id(relay),
        delegate_pubkey: vector[],
        revoked_at: ctx.epoch(),
    });
}

public fun relay_id(relay: &Relay): ID { object::id(relay) }
public fun from_channel(relay: &Relay): ID { relay.from_channel }
public fun to_channel(relay: &Relay): ID { relay.to_channel }
public fun from_memwal_account_id(relay: &Relay): ID { relay.from_memwal_account_id }
public fun digest_blob_id(relay: &Relay): String { relay.digest_blob_id }
public fun artifact_blob_ids(relay: &Relay): vector<String> { relay.artifact_blob_ids }
public fun memwal_namespace(relay: &Relay): String { relay.memwal_namespace }
public fun status(relay: &Relay): u8 { relay.status }
public fun is_pending(relay: &Relay): bool { relay.status == STATUS_PENDING }
public fun is_accepted(relay: &Relay): bool { relay.status == STATUS_ACCEPTED }
public fun is_completed(relay: &Relay): bool { relay.status == STATUS_COMPLETED }
public fun is_expired(relay: &Relay): bool { relay.status == STATUS_EXPIRED }
public fun relay_fee(): u64 { RELAY_FEE }
public fun treasury(): address { TREASURY }
public fun relay_timeout_epochs(): u64 { RELAY_TIMEOUT_EPOCHS }
