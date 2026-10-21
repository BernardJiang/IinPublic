import { runPortableCoreContracts } from '../../shared/portable-core-contracts';

const report = runPortableCoreContracts();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.failed > 0) process.exitCode = 1;
