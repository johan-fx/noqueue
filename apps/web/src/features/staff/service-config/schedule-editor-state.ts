import {
  readScheduleGroups,
  type ScheduleGroup,
  type ServiceInput,
} from '@noqueue/contracts/staff'

export type DraftGroup = ScheduleGroup & { key: string; confirmed: boolean }
export type ScheduleEditorState = {
  groups: DraftGroup[]
  activeKey: string | null
  errors: Record<string, string[]>
}
export type ScheduleEditorHandle = { confirm: () => boolean }
export function createScheduleEditorState(
  config: ServiceInput,
  editing = false,
): ScheduleEditorState {
  const source = readScheduleGroups(config)
  const groups = (
    source.length
      ? source
      : [
          {
            days: [1],
            twentyFourHours: false,
            ranges: [{ from: '12:00', to: '23:00' }],
          },
        ]
  ).map((group) => ({
    ...group,
    ranges: group.ranges.length
      ? group.ranges
      : [{ from: '12:00', to: '23:00' }],
    key: crypto.randomUUID(),
    confirmed: editing,
  }))
  return { groups, activeKey: groups[0]!.key, errors: {} }
}
export function serializeScheduleGroups(
  state: ScheduleEditorState,
): ScheduleGroup[] {
  return state.groups.map(({ days, twentyFourHours, ranges }) => ({
    days,
    twentyFourHours,
    ranges: twentyFourHours ? [] : ranges,
  }))
}
