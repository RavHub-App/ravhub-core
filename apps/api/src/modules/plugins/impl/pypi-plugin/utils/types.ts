export type { PluginContext } from '../../../../../plugins-core/plugin.interface';
export interface Repository {
  id: string;
  name: string;
  type: string;
  manager: string;
  config?: any;
}


