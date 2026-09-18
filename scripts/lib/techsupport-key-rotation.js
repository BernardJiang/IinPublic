'use strict';

function clone(config) {
  return JSON.parse(JSON.stringify(config));
}

function assertTrustAnchorConfig(config) {
  if (!config || config.version !== 1) throw new Error('Unsupported TechSupport trust-anchor config.');
  for (const role of ['dm', 'announcement']) {
    const entry = config[role];
    if (!entry || typeof entry.current !== 'string' || !Array.isArray(entry.trusted)) {
      throw new Error(`TechSupport ${role} trust-anchor config is malformed.`);
    }
    if (!entry.trusted.includes(entry.current)) {
      throw new Error(`Current TechSupport ${role} key must be in its trusted overlap list.`);
    }
    if (entry.trusted.length === 0 || new Set(entry.trusted).size !== entry.trusted.length) {
      throw new Error(`TechSupport ${role} trust-anchor list must be non-empty and contain no duplicates.`);
    }
  }
  return config;
}

function prepareRotation(config, newPub) {
  assertTrustAnchorConfig(config);
  if (typeof newPub !== 'string' || !newPub.trim()) throw new Error('New TechSupport public key is required.');
  const next = clone(config);
  for (const role of ['dm', 'announcement']) {
    if (!next[role].trusted.includes(newPub)) next[role].trusted.push(newPub);
  }
  return assertTrustAnchorConfig(next);
}

function activateRotation(config, newPub) {
  assertTrustAnchorConfig(config);
  const next = clone(config);
  for (const role of ['dm', 'announcement']) {
    if (!next[role].trusted.includes(newPub)) {
      throw new Error(`Prepare the overlap release before activating the new TechSupport ${role} key.`);
    }
    next[role].current = newPub;
    next[role].trusted = [newPub, ...next[role].trusted.filter((pub) => pub !== newPub)];
  }
  return assertTrustAnchorConfig(next);
}

function retireRotation(config, oldPub) {
  assertTrustAnchorConfig(config);
  const next = clone(config);
  for (const role of ['dm', 'announcement']) {
    if (next[role].current === oldPub) {
      throw new Error(`Cannot retire the current TechSupport ${role} key.`);
    }
    if (!next[role].trusted.includes(oldPub)) {
      throw new Error(`TechSupport ${role} key is not in the trusted overlap list.`);
    }
    next[role].trusted = next[role].trusted.filter((pub) => pub !== oldPub);
  }
  return assertTrustAnchorConfig(next);
}

module.exports = { activateRotation, assertTrustAnchorConfig, prepareRotation, retireRotation };
