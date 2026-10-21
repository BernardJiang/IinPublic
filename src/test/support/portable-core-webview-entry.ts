import { runPortableCoreContracts, type PortableCoreContractReport } from '../../shared/portable-core-contracts';

export type PortableCoreWebViewApi = {
  schemaVersion: 1;
  run: () => PortableCoreContractReport;
};

declare global {
  interface Window {
    __iinpublicPortableCoreTests?: PortableCoreWebViewApi;
  }
}

window.__iinpublicPortableCoreTests = {
  schemaVersion: 1,
  run: runPortableCoreContracts,
};
