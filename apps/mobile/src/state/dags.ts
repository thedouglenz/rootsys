import {
  createDagCommandAtoms,
  createEnvironmentDagAtoms,
} from "@t3tools/client-runtime/state/dags";

import { connectionAtomRuntime } from "../connection/runtime";

export const environmentDags = createEnvironmentDagAtoms(connectionAtomRuntime);
export const dagCommands = createDagCommandAtoms(connectionAtomRuntime);
