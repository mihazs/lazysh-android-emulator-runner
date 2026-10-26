jest.mock('@actions/core', () => ({ getInput: jest.fn(), setFailed: jest.fn() }));
jest.mock('@actions/exec', () => ({ exec: jest.fn().mockResolvedValue(0) }));
jest.mock('../src/sdk-installer', () => ({ installAndroidSdk: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/sdk-installer', () => jest.requireMock('../src/sdk-installer'));
jest.mock('../src/emulator-manager', () => ({
  createAvd: jest.fn().mockResolvedValue(undefined),
  launchEmulator: jest.fn().mockResolvedValue(undefined),
  killEmulator: jest.fn(),
}));
jest.mock('../lib/emulator-manager', () => jest.requireMock('../src/emulator-manager'));

const inputs: Record<string, string> = {
  'api-level': '36',
  target: 'default',
  arch: 'x86_64',
  'avd-name': 'owned-test-avd',
  'force-avd-creation': 'true',
  'emulator-boot-timeout': '300',
  'emulator-port': '5580',
  'emulator-options': '-no-window',
  'disable-animations': 'true',
  'disable-spellchecker': 'false',
  'disable-linux-hw-accel': 'false',
  'enable-hw-keyboard': 'false',
  channel: 'stable',
  script: 'echo owned-action-fixture',
};

describe.each(['../src/main', '../lib/main'])('%s action input forwarding', (entry) => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  async function run(unlockScreen: string) {
    const core = jest.requireMock('@actions/core');
    const runner = jest.requireMock('../src/emulator-manager');
    core.getInput.mockImplementation((name: string) => (name === 'unlock-screen' ? unlockScreen : (inputs[name] ?? '')));
    await new Promise<void>((resolve) => {
      // The existing entry point owns run(). Observe its normal final cleanup
      // without exporting a second entry or changing production execution.
      runner.killEmulator.mockImplementation(async () => {
        setImmediate(resolve);
      });
      require(entry);
    });
    return { core, runner };
  }

  it.each(['false', 'true'])('forwards validated unlock-screen=%s and preserves script/cleanup', async (value) => {
    const { core, runner } = await run(value);
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(runner.launchEmulator).toHaveBeenCalledWith('owned-test-avd', true, false, false, 300, '-no-window', false, 5580, value === 'true');
    const execute = jest.requireMock('@actions/exec').exec;
    expect(execute).toHaveBeenCalledWith('sh', ['-c', inputs.script], expect.objectContaining({ env: expect.objectContaining({ ANDROID_SERIAL: 'emulator-5580' }) }));
    expect(runner.killEmulator).toHaveBeenCalledWith(5580);
  });

  it('rejects malformed unlock-screen before SDK installation or emulator launch', async () => {
    const { core, runner } = await run('invalid');
    expect(core.setFailed).toHaveBeenCalledWith("Input for input.unlock-screen should be either 'true' or 'false'.");
    expect(jest.requireMock('../src/sdk-installer').installAndroidSdk).not.toHaveBeenCalled();
    expect(runner.createAvd).not.toHaveBeenCalled();
    expect(runner.launchEmulator).not.toHaveBeenCalled();
    expect(jest.requireMock('@actions/exec').exec).not.toHaveBeenCalled();
  });
});
