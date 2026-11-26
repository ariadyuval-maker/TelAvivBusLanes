import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseIPhone } from './ios-smoke.mjs';

test('simulator selection excludes unavailable phones and non-iOS devices', () => {
    const result = chooseIPhone({
        'com.apple.CoreSimulator.SimRuntime.tvOS-26-0': [{name:'iPhone fake', isAvailable:true}],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
            {name:'iPhone unavailable', isAvailable:false}, {name:'iPad', isAvailable:true},
            {name:'iPhone test', isAvailable:true, udid:'phone'}]
    });
    assert.equal(result.udid, 'phone');
});
test('simulator selection uses numeric runtime order', () => {
    const phone = {name:'iPhone', isAvailable:true};
    assert.equal(chooseIPhone({
        'com.apple.CoreSimulator.SimRuntime.iOS-26-9': [phone],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-10': [phone]
    }).runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-26-10');
});
test('missing iPhone runtime fails explicitly', () => {
    assert.throws(() => chooseIPhone({}), /No available iPhone/);
});
