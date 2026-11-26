import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function chooseIPhone(devices) {
    const candidates = Object.entries(devices)
        .filter(([runtime]) => runtime.includes('.iOS-'))
        .flatMap(([runtime, list]) => list.map(device => ({ ...device, runtime })))
        .filter(device => device.isAvailable && device.name.startsWith('iPhone'))
        .sort((a, b) => b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) || a.name.localeCompare(b.name));
    if (!candidates.length) throw Error('No available iPhone simulator; inspect devices.json');
    return candidates[0];
}

async function main() {
    if (process.platform !== 'darwin') throw Error('This check requires macOS/Xcode');
    const output = path.resolve('artifacts/ios-smoke');
    mkdirSync(output, { recursive: true });
    const run = (args, timeout = 120000) => execFileSync('xcrun', ['simctl', ...args], {
        encoding: 'utf8', timeout, maxBuffer: 20 * 1024 * 1024
    });
    const raw = run(['list', 'devices', 'available', '--json']);
    writeFileSync(path.join(output, 'devices.json'), raw);
    const device = chooseIPhone(JSON.parse(raw).devices);
    const { appId } = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
    writeFileSync(path.join(output, 'selection.json'), JSON.stringify({ device, appId }, null, 2));
    console.log(`Smoke check: ${device.name} (${device.runtime})`);
    if (device.state !== 'Booted') run(['boot', device.udid]);
    run(['bootstatus', device.udid, '-b'], 240000);
    run(['status_bar', device.udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100']);
    run(['install', device.udid, path.resolve('artifacts/ios-derived/Build/Products/Debug-iphonesimulator/App.app')]);
    const launch = run(['launch', device.udid, appId]);
    writeFileSync(path.join(output, 'launch.txt'), launch);
    // Allow network-backed content to load; screenshot review decides UI success.
    await new Promise(resolve => setTimeout(resolve, 20000));
    run(['io', device.udid, 'screenshot', path.join(output, 'portrait.png')]);
    try {
        const logs = run(['spawn', device.udid, 'log', 'show', '--last', '1m', '--style', 'compact', '--predicate', 'process == "App"']);
        writeFileSync(path.join(output, 'app.log'), logs);
    } catch (error) {
        writeFileSync(path.join(output, 'log-collection-error.txt'), error.message);
    }
    console.log('Install/launch/screenshot commands completed. UI and background behavior still require review.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
