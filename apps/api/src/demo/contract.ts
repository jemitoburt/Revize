// Compile-time check that the web app's declaration of this module (apps/web typechecks against
// it instead of these sources) still matches the implementation.
import type * as Declared from '../../../web/src/demo/api-demo.js';
import type * as Actual from './index.js';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const contract: [
  Same<typeof Actual.createDemoApi, typeof Declared.createDemoApi>,
  Same<typeof Actual.applyMigrations, typeof Declared.applyMigrations>,
  Same<Actual.DemoRequest, Declared.DemoRequest>,
  Same<Actual.DemoResponse, Declared.DemoResponse>,
] = [true, true, true, true];
