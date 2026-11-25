// The component kit. Screens import from here, never from a component's own file:
//   import { Button, Card, DataTable } from '@/components';
// Styles use the tokens in src/styles/tokens.css (a test fails on raw colours). Each component has
// Vitest and axe tests in tests/unit/components/. docs/design/ is the visual spec.
export { Banner, InlineError } from './Banner';
export type { BannerProps } from './Banner';
export { BarBreakdown } from './BarBreakdown';
export type { Bar, BarBreakdownProps } from './BarBreakdown';
export { Button, ButtonLink, IconButton } from './Button';
export type { ButtonLinkProps, ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './Button';
export { Card } from './Card';
export type { CardProps } from './Card';
export { ChipList, FilterChip, Pill, RemovableChip } from './Chip';
export type { FilterChipProps, PillTone, RemovableChipProps } from './Chip';
export { CountTile, TileGrid } from './CountTile';
export type { CountTileProps } from './CountTile';
export { DataTable } from './DataTable';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { ErrorNotice } from './ErrorNotice';
export type { ErrorNoticeProps } from './ErrorNotice';
export type { Column, DataTableProps } from './DataTable';
export { markTerms } from './markTerms';
export type { Piece } from './markTerms';
export { MethodologyCard } from './MethodologyCard';
export type { MethodologyCardProps } from './MethodologyCard';
export { describeMonths } from './monthSummary';
export { MonthChart } from './MonthChart';
export type { MonthChartProps, MonthCount } from './MonthChart';
export { SegmentedControl } from './SegmentedControl';
export type { Segment, SegmentedControlProps, SegmentTone } from './SegmentedControl';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
