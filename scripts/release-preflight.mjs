import assert from 'node:assert/strict';
import {
  argumentsFor,
  gitState,
  releaseConfiguration,
  targets,
  validateProductionInputs,
} from '../internal/build-config/release.mjs';
import { root } from './process.mjs';

const options = argumentsFor(process.argv.slice(2));
const configuration = releaseConfiguration({
  mode: options.mode,
  target: options.target,
  channel: options.channel,
  feedBaseUrl: options['feed-base-url'],
});
const selected = targets[options.target];
assert.equal(process.platform, selected.platform, 'Use the native OS runner');
assert.equal(process.arch, selected.arch, 'Use the native architecture runner');
validateProductionInputs(configuration, process.env, gitState(root).dirty);
console.log(
  `${configuration.mode} inputs validated for ${options.target}; this is not release acceptance`,
);
