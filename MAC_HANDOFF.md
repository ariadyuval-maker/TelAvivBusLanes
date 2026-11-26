# First Mac session checklist

Purpose: install the foreground app on Yuval's iPhone. Background GPS/audio is
not implemented yet. No App Store submission or paid account purchase required
for this initial local Xcode test with a Personal Team, subject to Apple's current
free-signing limitations.

## Before the visit

1. Confirm the iOS work is committed and pushed to feature/ios. Local uncommitted
   files do not appear when your friend clones the repository.
2. Ask your friend to install Xcode 26 or newer and launch it once to complete
   Apple's setup. Install Node 22 or newer with npm.
3. Bring the iPhone and a USB cable. Do not send Apple passwords or signing keys
   through chat or commit them to Git.

## On the Mac

```sh
git clone --branch feature/ios https://github.com/ariadyuval-maker/TelAvivBusLanes.git
cd TelAvivBusLanes
node --version
xcodebuild -version
npm install
npm test
npm run ios:add
npm run ios:open
```

If ios/ already exists, use `npm run ios:sync` instead of ios:add. Capacitor
packages are pinned to 8.0.0 as a common baseline; dependency installation and
the first build have not yet been verified. Commit the resulting package lock
and review the generated native project after a successful build.

In Xcode select App > Signing & Capabilities, choose the intended team, and
check the bundle ID (currently a development proposal,
com.yuvalariad.telavivpubliclanes). Connect/unlock the phone, trust the Mac and
enable Developer Mode if iOS requests it. Choose the physical phone as target
and Run. The account owner enters any credentials themselves.

## Acceptance checklist

- [ ] App installs and opens on the phone.
- [ ] Hebrew text, header, map and buttons render correctly.
- [ ] Camera and lane data load over the network.
- [ ] Reports, simulator and voice picker open and close.
- [ ] Portrait and landscape fit safe areas without horizontal scrolling.
- [ ] Record device model, iOS version, Xcode version, commit SHA and screenshots.
- [ ] Report console errors without personal location or credentials.

Do not count foreground operation as proof of background alerts. Next native
milestone is a deliberately started/stopped trip receiving location while Waze
is foregrounded and while the screen is locked, followed by native speech.
Location permission strings and background modes must be implemented before
testing that milestone. The simulator CI artifact cannot be installed on an
iPhone and is not an IPA.

## Cloud workflow

The manual `iOS simulator build` GitHub Action builds without signing secrets.
It has not run yet. It assumes Xcode_26.0.app is present on macos-15 and fails
explicitly otherwise. First run may require adjusting the selected runner/Xcode
path based on runner inventory. Never report this build as passing until CI
confirms it. It builds a simulator app, not a device installation package.
