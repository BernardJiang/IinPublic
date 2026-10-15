import {
  portableCoreContracts,
  runPortableCoreContracts,
} from '../../shared/portable-core-contracts';

describe('portable core contracts', () => {
  it('has unique stable ids', () => {
    const ids = portableCoreContracts().map((contract) => contract.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(6);
  });

  it('passes in the Jest host runtime', () => {
    const report = runPortableCoreContracts();
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(report.total);
  });
});
