module patchway::relay_fee_tests;

use sui::test_scenario;
use sui::coin;
use sui::sui::SUI;
use patchway::channel;
use patchway::relay;

const ADMIN: address = @0xA;

#[test]
fun test_create_relay_with_fee() {
    let mut scenario = test_scenario::begin(ADMIN);

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

    scenario.next_tx(ADMIN);
    {
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());

        relay::create_relay_with_fee(
            &from_ch,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            vector[0u8, 1, 2, 3],
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.next_tx(ADMIN);
    {
        let r = scenario.take_shared<relay::Relay>();
        assert!(relay::is_pending(&r));
        assert!(relay::status(&r) == 0);
        test_scenario::return_shared(r);
    };

    scenario.end();
}

#[test]
#[expected_failure(abort_code = relay::EInsufficientFee)]
fun test_create_relay_with_insufficient_fee() {
    let mut scenario = test_scenario::begin(ADMIN);

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

    scenario.next_tx(ADMIN);
    {
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(1_000_000, scenario.ctx());

        relay::create_relay_with_fee(
            &from_ch,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            vector[0u8, 1, 2, 3],
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.end();
}

#[test]
fun test_relay_fee_constant() {
    assert!(relay::relay_fee() == 10_000_000);
}

// v4.2 (P2.2) — the fee-free create_relay is now gated off to close the fee-bypass.
#[test]
#[expected_failure(abort_code = relay::EFeeBypassDisabled)]
fun test_fee_free_create_relay_is_disabled() {
    let mut scenario = test_scenario::begin(ADMIN);

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

    scenario.next_tx(ADMIN);
    {
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();

        relay::create_relay(
            &from_ch,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            vector[0u8, 1, 2, 3],
            scenario.ctx(),
        );

        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    scenario.end();
}

#[test]
fun test_full_relay_lifecycle_with_fee() {
    let mut scenario = test_scenario::begin(ADMIN);

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

    // Create relay with fee
    scenario.next_tx(ADMIN);
    {
        let from_ch = scenario.take_shared<channel::Channel>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let fee = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());

        relay::create_relay_with_fee(
            &from_ch,
            channel::channel_id(&to_ch),
            @0xDEAD.to_id(),
            b"blobid123".to_string(),
            vector[],
            vector[0u8, 1, 2, 3],
            fee,
            scenario.ctx(),
        );

        test_scenario::return_shared(from_ch);
        test_scenario::return_shared(to_ch);
    };

    // Accept
    scenario.next_tx(ADMIN);
    {
        let mut r = scenario.take_shared<relay::Relay>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let from_ch = scenario.take_shared<channel::Channel>();

        // Find the channel that matches to_channel on the relay
        if (relay::to_channel(&r) == channel::channel_id(&to_ch)) {
            relay::accept_relay(&mut r, &to_ch, scenario.ctx());
        } else {
            relay::accept_relay(&mut r, &from_ch, scenario.ctx());
        };

        assert!(relay::is_accepted(&r));
        test_scenario::return_shared(r);
        test_scenario::return_shared(to_ch);
        test_scenario::return_shared(from_ch);
    };

    // Complete
    scenario.next_tx(ADMIN);
    {
        let mut r = scenario.take_shared<relay::Relay>();
        let to_ch = scenario.take_shared<channel::Channel>();
        let from_ch = scenario.take_shared<channel::Channel>();

        if (relay::to_channel(&r) == channel::channel_id(&to_ch)) {
            relay::complete_relay(&mut r, &to_ch, scenario.ctx());
        } else {
            relay::complete_relay(&mut r, &from_ch, scenario.ctx());
        };

        assert!(relay::is_completed(&r));
        test_scenario::return_shared(r);
        test_scenario::return_shared(to_ch);
        test_scenario::return_shared(from_ch);
    };

    scenario.end();
}
