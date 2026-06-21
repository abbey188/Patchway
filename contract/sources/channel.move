module patchway::channel;

use sui::event;
use sui::derived_object;
use std::string::String;

#[error]
const ENotOwner: vector<u8> = b"Caller is not the channel owner";
#[error]
const EAlreadyInactive: vector<u8> = b"Channel is already inactive";
#[error]
const EAlreadyActive: vector<u8> = b"Channel is already active";

public struct Channel has key, store {
    id: UID,
    owner: address,
    agent_id: String,
    memwal_namespace: String,
    accepts: vector<String>,
    created_at: u64,
    active: bool,
}

// v4.1 — protocol config + derivation anchor. Shared once at publish; the channel
// derivation derives from `Config.id`, so a channel's address is a deterministic
// function of (Config.id, owner, agent_id) — computable off-chain with zero queries.
public struct Config has key {
    id: UID,
    treasury: address,
    relay_fee: u64,
}

// Admin authority over Config (treasury / fee). Minted to the publisher.
public struct AdminCap has key, store { id: UID }

// Derivation key: a channel ID is derived from (owner, agent_id). Reusing the same
// (owner, agent_id) collides on the same address → `claim` aborts, giving on-chain
// name uniqueness for free.
public struct ChannelKey has copy, drop, store {
    owner: address,
    agent_id: String,
}

fun init(ctx: &mut TxContext) {
    bootstrap(ctx);
}

// `init` does not run on package UPGRADES, only on fresh publishes — so the real
// v4.1 upgrade bootstraps Config once via this publisher-gated entry. Guarded to
// the deployer so a stranger can't mint an AdminCap or a rogue Config.
entry fun create_config(ctx: &mut TxContext) {
    assert!(ctx.sender() == @0x2717627095bc5e7ff69cbe86938ccb5e57fcd485116ff3328e05494da01b0068, ENotOwner);
    bootstrap(ctx);
}

fun bootstrap(ctx: &mut TxContext) {
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(Config {
        id: object::new(ctx),
        treasury: ctx.sender(),
        relay_fee: 10_000_000,
    });
}

public struct ChannelCreated has copy, drop {
    channel_id: ID,
    owner: address,
    agent_id: String,
    memwal_namespace: String,
    created_at: u64,
}

public struct ChannelDeactivated has copy, drop {
    channel_id: ID,
    owner: address,
}

public struct ChannelReactivated has copy, drop {
    channel_id: ID,
    owner: address,
}

entry fun create_channel(
    agent_id: String,
    memwal_namespace: String,
    accepts: vector<String>,
    ctx: &mut TxContext,
) {
    let channel = Channel {
        id: object::new(ctx),
        owner: ctx.sender(),
        agent_id,
        memwal_namespace,
        accepts,
        created_at: ctx.epoch(),
        active: true,
    };
    event::emit(ChannelCreated {
        channel_id: object::id(&channel),
        owner: ctx.sender(),
        agent_id: channel.agent_id,
        memwal_namespace: channel.memwal_namespace,
        created_at: channel.created_at,
    });
    transfer::share_object(channel);
}

// v4.1 — create a Channel at a derived address. The ID is deterministic in
// (Config.id, owner, agent_id), so agents can compute each other's channel IDs
// locally with no GraphQL query. Aborts if this (owner, agent_id) already exists.
entry fun create_channel_derived(
    config: &mut Config,
    agent_id: String,
    accepts: vector<String>,
    ctx: &mut TxContext,
) {
    let owner = ctx.sender();
    let uid = derived_object::claim(&mut config.id, ChannelKey { owner, agent_id });
    let channel = Channel {
        id: uid,
        owner,
        agent_id,
        memwal_namespace: agent_id,
        accepts,
        created_at: ctx.epoch(),
        active: true,
    };
    event::emit(ChannelCreated {
        channel_id: object::id(&channel),
        owner,
        agent_id: channel.agent_id,
        memwal_namespace: channel.memwal_namespace,
        created_at: channel.created_at,
    });
    transfer::share_object(channel);
}

// Admin: update the protocol fee / treasury without a redeploy (m3).
entry fun set_relay_fee(_: &AdminCap, config: &mut Config, fee: u64) {
    config.relay_fee = fee;
}

entry fun set_treasury(_: &AdminCap, config: &mut Config, treasury: address) {
    config.treasury = treasury;
}

public fun relay_fee(config: &Config): u64 { config.relay_fee }
public fun treasury(config: &Config): address { config.treasury }

entry fun deactivate_channel(
    channel: &mut Channel,
    ctx: &TxContext,
) {
    assert!(channel.owner == ctx.sender(), ENotOwner);
    assert!(channel.active, EAlreadyInactive);
    channel.active = false;
    event::emit(ChannelDeactivated {
        channel_id: object::id(channel),
        owner: ctx.sender(),
    });
}

entry fun reactivate_channel(
    channel: &mut Channel,
    ctx: &TxContext,
) {
    assert!(channel.owner == ctx.sender(), ENotOwner);
    assert!(!channel.active, EAlreadyActive);
    channel.active = true;
    event::emit(ChannelReactivated {
        channel_id: object::id(channel),
        owner: ctx.sender(),
    });
}

public fun owner(channel: &Channel): address { channel.owner }

public fun agent_id(channel: &Channel): String { channel.agent_id }

public fun memwal_namespace(channel: &Channel): String { channel.memwal_namespace }

public fun accepts(channel: &Channel): vector<String> { channel.accepts }

public fun is_active(channel: &Channel): bool { channel.active }

public fun channel_id(channel: &Channel): ID { object::id(channel) }
