import { Expert } from "./types";

import defaultConfig from "@/config/default-config.json";

export const experts: Expert[] = defaultConfig.experts;

export const moderatorModes = defaultConfig.moderatorModes;

export function pickExperts(ids: string[]): Expert[] {
  const idSet = new Set(ids);
  return experts.filter((expert) => idSet.has(expert.id));
}

export function mergeSystemExperts(baseExperts: Expert[], overrides: Partial<Expert>[]): Expert[] {
  const overrideMap = new Map(overrides.map(o => [o.id, o]));
  return baseExperts.map(base => {
    const override = overrideMap.get(base.id);
    if (override) {
      return { ...base, ...override };
    }
    return base;
  });
}
