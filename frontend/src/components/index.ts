// The component kit. Screens import from here, never from a component's own file:
//   import { Button, Card, DataTable } from '@/components';
// Styles use the tokens in src/styles/tokens.css (a test fails on raw colours). Each component has
// Vitest and axe tests in tests/unit/components/. docs/design/ is the visual spec.
export { Button, ButtonLink, IconButton } from './Button';
export type { ButtonLinkProps, ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './Button';
export { Card } from './Card';
export type { CardProps } from './Card';
export { ChipList, FilterChip, Pill, RemovableChip } from './Chip';
export type { FilterChipProps, PillTone, RemovableChipProps } from './Chip';
export { DataTable } from './DataTable';
export type { Column, DataTableProps } from './DataTable';
export { SegmentedControl } from './SegmentedControl';
export type { Segment, SegmentedControlProps, SegmentTone } from './SegmentedControl';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
