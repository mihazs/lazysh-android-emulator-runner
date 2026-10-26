import * as exec from '@actions/exec';
import { killEmulator, launchEmulator } from '../src/emulator-manager';

jest.mock('@actions/exec', () => ({ exec: jest.fn() }));

const compiled = require('../lib/emulator-manager') as typeof import('../src/emulator-manager');
const execute = jest.mocked(exec.exec);
const serial = 'adb -s emulator-5580';
const boot = `${serial} shell getprop sys.boot_completed`;
const menu = `${serial} shell input keyevent 82`;
const settings = [
  'global window_animation_scale 0.0',
  'global transition_animation_scale 0.0',
  'global animator_duration_scale 0.0',
  'secure spell_checker_enabled 0',
  'secure show_ime_with_hard_keyboard 0',
].map((setting) => `${serial} shell settings put ${setting}`);

describe.each([
  { name: 'source', launch: launchEmulator, kill: killEmulator },
  { name: 'compiled action', launch: compiled.launchEmulator, kill: compiled.killEmulator },
])('$name screen-unlock contract', ({ launch, kill }) => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockImplementation(async (command, _args, options) => {
      if (command === boot) options?.listeners?.stdout?.(Buffer.from('1\r\n'));
      return 0;
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  async function start(unlockScreen?: boolean, configure = true, bootTimeout = 300) {
    await launch('owned-test-avd', configure, false, configure, bootTimeout, '-no-window -accel on', configure, 5580, unlockScreen);
  }
  function adbCommands() {
    return execute.mock.calls.map(([command]) => command).filter((command) => typeof command === 'string' && command.startsWith(serial));
  }

  it('opt-out skips only synthetic MENU while retaining boot and every requested setting', async () => {
    await start(false);
    expect(adbCommands()).toEqual([boot, ...settings]);
    expect(execute.mock.calls[0][0]).toContain('-port 5580 -avd "owned-test-avd" -no-window -accel on');
  });

  it.each([undefined, true])('preserves MENU ordering when unlock-screen is %s', async (value) => {
    await start(value);
    expect(adbCommands()).toEqual([boot, menu, ...settings]);
  });

  it('does not enable optional settings when both settings and unlock are disabled', async () => {
    await start(false, false);
    expect(adbCommands()).toEqual([boot]);
  });

  it('keeps boot failure fatal without issuing MENU or settings', async () => {
    execute.mockImplementation(async (command) => {
      if (command === boot) throw new Error('owned fixture boot failure');
      return 0;
    });
    await expect(start(false, true, 0)).rejects.toThrow('Timeout waiting for emulator to boot.');
    expect(adbCommands()).toEqual([boot]);
  });

  it('retains the existing emulator shutdown command', async () => {
    await kill(5580);
    expect(adbCommands()).toEqual([`${serial} emu kill`]);
  });
});
