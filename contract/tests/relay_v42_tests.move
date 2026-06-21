#[test_only]
module patchway::relay_v42_tests;

use sui::test_scenario;
use sui::coin;
use sui::sui::SUI;
use patchway::channel;
use patchway::relay;

// create_config is publisher-gated to the deployer address — use it as the test
// sender so we can bootstrap a real Config + AdminCap.
const DEPLOYER: address = @0x2717627095bc5e7ff69cbe86938ccb5e57fcd485116ff3328e05494da01b0068;

// A valid 32-byte SHA-256-shaped digest hash.
fun hash32(): vector<u8> {
    let mut v = vector[];
    let mut i = 0u64;
    while (i < 32) { v.push_back((i as u8)); i = i + 1; };
    v
}

fun setup_channels(scenario: &mut test_scenario::Scenario) {
    channel::create_channel(
        b"researcher".to_string(),
        b"thread".to_string(),
        vector[b"research".to_string()],
        scenario.ctx(),
    );
    channel::create_channel(
        b"analyst".to_string(),
        b"thread".to_string(),
        vector[b"analysis".to_string()],
        scenario.ctx(),
    );
}

// ── Fee split + change return (P2.3) ────────────────────────────────────────────
#[test]
fun test_create_with_config_splits_fee_and_returns_change() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    channel::create_config(scenario.ctx()); // bootstraps Config (fee 0.01 SUI) + AdminCap
    setup_channels(&mut scenario);

    scenario.next_tx(DEPLOYER);
    {
        let config = scenario.take_shared<channel::Config>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        // Overpay: 0.05 SUI for a 0.01 SUI fee → 0.04 SUI change must come back.
        let fee = coin::mint_for_testing<SUI>(50_000_000, scenario.ctx());

        relay::create_relay_with_config(
            &from_ch,
            &config,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            hash32(),
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(config);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    // Change coin (0.04 SUI) must be owned by the sender now.
    scenario.next_tx(DEPLOYER);
    {
        let change = scenario.take_from_sender<coin::Coin<SUI>>();
        assert!(coin::value(&change) == 40_000_000);
        scenario.return_to_sender(change);

        let r = scenario.take_shared<relay::Relay>();
        assert!(relay::is_pending(&r));
        test_scenario::return_shared(r);
    };

    scenario.end();
}

#[test]
fun test_create_with_config_exact_fee_no_change() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    channel::create_config(scenario.ctx());
    setup_channels(&mut scenario);

    scenario.next_tx(DEPLOYER);
    {
        let config = scenario.take_shared<channel::Config>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());

        relay::create_relay_with_config(
            &from_ch,
            &config,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            hash32(),
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(config);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.next_tx(DEPLOYER);
    {
        let r = scenario.take_shared<relay::Relay>();
        assert!(relay::is_pending(&r));
        test_scenario::return_shared(r);
    };

    scenario.end();
}

// ── Digest hash length assertion (P3.1) ─────────────────────────────────────────
#[test]
#[expected_failure(abort_code = relay::EBadDigestHash)]
fun test_create_with_config_rejects_short_digest_hash() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    channel::create_config(scenario.ctx());
    setup_channels(&mut scenario);

    scenario.next_tx(DEPLOYER);
    {
        let config = scenario.take_shared<channel::Config>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());

        relay::create_relay_with_config(
            &from_ch,
            &config,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            vector[0u8, 1, 2, 3], // 4 bytes — must abort
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(config);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.end();
}

// ── accept_relay_v2 / complete_relay_v2 lifecycle + access events ────────────────
#[test]
fun test_accept_complete_v2_lifecycle() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    channel::create_config(scenario.ctx());
    setup_channels(&mut scenario);

    scenario.next_tx(DEPLOYER);
    {
        let config = scenario.take_shared<channel::Config>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());

        relay::create_relay_with_config(
            &from_ch,
            &config,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            hash32(),
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(config);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    let pubkey = vector[9u8, 8, 7, 6, 5, 4, 3, 2, 1];

    // accept_relay_v2 by the recipient (to_channel owner == DEPLOYER here)
    scenario.next_tx(DEPLOYER);
    {
        let mut r = scenario.take_shared<relay::Relay>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let from_ch = scenario.take_shared<channel::Channel>();

        if (relay::to_channel(&r) == channel::channel_id(&to_ch)) {
            relay::accept_relay_v2(&mut r, &to_ch, pubkey, scenario.ctx());
        } else {
            relay::accept_relay_v2(&mut r, &from_ch, pubkey, scenario.ctx());
        };

        assert!(relay::is_accepted(&r));
        test_scenario::return_shared(r);
        test_scenario::return_shared(to_ch);
        test_scenario::return_shared(from_ch);
    };

    // complete_relay_v2
    scenario.next_tx(DEPLOYER);
    {
        let mut r = scenario.take_shared<relay::Relay>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let from_ch = scenario.take_shared<channel::Channel>();

        if (relay::to_channel(&r) == channel::channel_id(&to_ch)) {
            relay::complete_relay_v2(&mut r, &to_ch, pubkey, scenario.ctx());
        } else {
            relay::complete_relay_v2(&mut r, &from_ch, pubkey, scenario.ctx());
        };

        assert!(relay::is_completed(&r));
        test_scenario::return_shared(r);
        test_scenario::return_shared(to_ch);
        test_scenario::return_shared(from_ch);
    };

    scenario.end();
}

// ── cancel_relay by either party, no time check ─────────────────────────────────
#[test]
fun test_cancel_relay_by_sender() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    channel::create_config(scenario.ctx());
    setup_channels(&mut scenario);

    scenario.next_tx(DEPLOYER);
    {
        let config = scenario.take_shared<channel::Config>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());

        relay::create_relay_with_config(
            &from_ch,
            &config,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            hash32(),
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(config);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.next_tx(DEPLOYER);
    {
        let mut r = scenario.take_shared<relay::Relay>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();

        // Cancel from the sending side while still PENDING — no time check.
        if (relay::from_channel(&r) == channel::channel_id(&from_ch)) {
            relay::cancel_relay(&mut r, &from_ch, vector[], scenario.ctx());
        } else {
            relay::cancel_relay(&mut r, &to_ch, vector[], scenario.ctx());
        };

        assert!(relay::is_expired(&r));
        test_scenario::return_shared(r);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.end();
}

// ── time-bounded expire rejects when called too early ───────────────────────────
#[test]
#[expected_failure(abort_code = relay::ETooEarly)]
fun test_expire_timed_rejects_early() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    channel::create_config(scenario.ctx());
    setup_channels(&mut scenario);

    scenario.next_tx(DEPLOYER);
    {
        let config = scenario.take_shared<channel::Config>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());

        relay::create_relay_with_config(
            &from_ch,
            &config,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            hash32(),
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(config);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    // Same epoch as creation → created_at + 7 > epoch → ETooEarly.
    scenario.next_tx(DEPLOYER);
    {
        let mut r = scenario.take_shared<relay::Relay>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();

        if (relay::from_channel(&r) == channel::channel_id(&from_ch)) {
            relay::expire_relay_timed(&mut r, &from_ch, scenario.ctx());
        } else {
            relay::expire_relay_timed(&mut r, &to_ch, scenario.ctx());
        };

        test_scenario::return_shared(r);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.end();
}

// ── time-bounded expire allowed after the window ────────────────────────────────
#[test]
fun test_expire_timed_allows_after_window() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    channel::create_config(scenario.ctx());
    setup_channels(&mut scenario);

    scenario.next_tx(DEPLOYER);
    {
        let config = scenario.take_shared<channel::Config>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());

        relay::create_relay_with_config(
            &from_ch,
            &config,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            hash32(),
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(config);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    // Advance the epoch past the timeout window (7 epochs).
    let mut i = 0u64;
    while (i < 8) { scenario.next_epoch(DEPLOYER); i = i + 1; };

    scenario.next_tx(DEPLOYER);
    {
        let mut r = scenario.take_shared<relay::Relay>();
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();

        if (relay::from_channel(&r) == channel::channel_id(&from_ch)) {
            relay::expire_relay_timed(&mut r, &from_ch, scenario.ctx());
        } else {
            relay::expire_relay_timed(&mut r, &to_ch, scenario.ctx());
        };

        assert!(relay::is_expired(&r));
        test_scenario::return_shared(r);
        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.end();
}
