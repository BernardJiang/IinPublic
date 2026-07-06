import { getDevStageZeroMaxGlobalMembers } from '../../web/dev-stage-env';

describe('dev stage environment helpers', () => {
  const original = process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL;

  afterEach(() => {
    if (original == null) {
      delete process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL;
    } else {
      process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL = original;
    }
  });

  it('defaults stage-zero Global repair threshold to three members', () => {
    delete process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL;
    expect(getDevStageZeroMaxGlobalMembers()).toBe(3);
  });

  it('allows dev:multi to opt into TechSupport plus three browser users', () => {
    process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL = '4';
    expect(getDevStageZeroMaxGlobalMembers()).toBe(4);
  });

  it('ignores invalid values instead of disabling the scrubber', () => {
    process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL = 'many';
    expect(getDevStageZeroMaxGlobalMembers()).toBe(3);

    process.env.IINPUBLIC_STAGE_ZERO_MAX_GLOBAL = '0';
    expect(getDevStageZeroMaxGlobalMembers()).toBe(3);
  });
});
