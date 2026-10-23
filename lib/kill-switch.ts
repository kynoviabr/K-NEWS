export type KillSwitch = {
  enabled: boolean;
  reason?: string;
  at?: string;
};

let _killSwitch: KillSwitch = { enabled: false };

export function setKillSwitch(ks: KillSwitch) {
  _killSwitch = ks;
}

export function getKillSwitch(): KillSwitch {
  return _killSwitch;
}

export function canPublish(): boolean {
  return !_killSwitch.enabled;
}
