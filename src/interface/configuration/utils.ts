import { createTokamakL2Common } from "../../common/index.js";
import { TokamakL2StateManagerRPCOpts } from "../../stateManager/types.js";
import { ChannelStateConfig } from "./types.js";


export function createStateManagerOptsFromChannelConfig(
  _config: ChannelStateConfig
): TokamakL2StateManagerRPCOpts {
  return {
    common: createTokamakL2Common(),
  };
}
