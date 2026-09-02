/**
 * SPOT icon set — transcribed 1:1 from the design handoff SVG symbols.
 * Usage: <Icon name="search" size={24} color={palette.inkText} />
 */
import { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'search' | 'sliders' | 'pin' | 'star' | 'chevR' | 'chevL' | 'chevD'
  | 'x' | 'check' | 'plus' | 'heart' | 'msg' | 'bell' | 'dumbbell' | 'play'
  | 'flame' | 'users' | 'user' | 'cal' | 'clock' | 'cam' | 'lock' | 'shield'
  | 'share' | 'more' | 'trophy' | 'target' | 'bookmark' | 'bookmarkOn' | 'verified' | 'apple'
  | 'scale' | 'meal' | 'timer' | 'video' | 'grid' | 'edit' | 'qr' | 'arrowU'
  | 'sound' | 'mute';

const paths: Record<IconName, (c: string) => ReactNode> = {
  search: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round">
      <Circle cx={10.5} cy={10.5} r={6.5} />
      <Path d="M15.5 15.5 20 20" />
    </G>
  ),
  sliders: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round">
      <Path d="M4 8h10M18.5 8H20M4 16h4M12.5 16H20" />
      <Circle cx={16} cy={8} r={2.3} />
      <Circle cx={10} cy={16} r={2.3} />
    </G>
  ),
  pin: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
      <Circle cx={12} cy={10} r={2.6} />
    </G>
  ),
  star: (c) => <Path d="M12 3.2l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.6l6-.8z" fill={c} />,
  chevR: (c) => <Path d="M9 5l7 7-7 7" fill="none" stroke={c} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" />,
  chevL: (c) => <Path d="M15 5l-7 7 7 7" fill="none" stroke={c} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" />,
  chevD: (c) => <Path d="M5 9l7 7 7-7" fill="none" stroke={c} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" />,
  x: (c) => <Path d="M6 6l12 12M18 6L6 18" fill="none" stroke={c} strokeWidth={2.1} strokeLinecap="round" />,
  check: (c) => <Path d="M4.5 12.5l5 5 10-11" fill="none" stroke={c} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />,
  plus: (c) => <Path d="M12 5v14M5 12h14" fill="none" stroke={c} strokeWidth={2.1} strokeLinecap="round" />,
  heart: (c) => <Path d="M12 20s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8 3.2C20 15.1 12 20 12 20z" fill={c} />,
  msg: (c) => (
    <Path
      d="M4 11.5c0-4 3.6-6.8 8-6.8s8 2.8 8 6.8-3.6 6.9-8 6.9a10 10 0 0 1-2.6-.3L5.5 20l.8-3.2A6.9 6.9 0 0 1 4 11.5z"
      fill="none" stroke={c} strokeWidth={1.9} strokeLinejoin="round"
    />
  ),
  bell: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5z" />
      <Path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
    </G>
  ),
  dumbbell: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round">
      <Path d="M3 9.5v5M6 7v10M18 7v10M21 9.5v5M6 12h12" />
    </G>
  ),
  play: (c) => <Path d="M7 4.5l13 7.5L7 19.5z" fill={c} />,
  sound: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9v6h3l5 4V5L7 9z" fill={c} />
      <Path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
    </G>
  ),
  mute: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9v6h3l5 4V5L7 9z" fill={c} />
      <Path d="M16 9.5l5 5M21 9.5l-5 5" />
    </G>
  ),
  flame: (c) => (
    <Path
      d="M13 2.5c.6 3.4-1.4 4.6-2.8 6.2C8.4 10.7 8 12 8 13.4A6 6 0 0 0 20 14c0-4.4-3.5-6.4-7-11.5zM9.8 15.6c.3 2 1.6 3.2 3 3.7-2.6.4-4.6-1-4.8-2.8-.1-1 .4-1.9 1.1-2.6-.1.6-.2 1.1-.3 1.7z"
      fill={c}
    />
  ),
  users: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={9} cy={8.5} r={3.4} />
      <Path d="M3 19.5c.7-3.2 3-4.8 6-4.8s5.3 1.6 6 4.8" />
      <Path d="M16 5.6a3.4 3.4 0 0 1 0 5.8M17.5 15.2c2 .6 3.2 2.1 3.5 4.3" />
    </G>
  ),
  user: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round">
      <Circle cx={12} cy={8} r={3.8} />
      <Path d="M4.5 20c.9-3.6 3.8-5.4 7.5-5.4s6.6 1.8 7.5 5.4" />
    </G>
  ),
  cal: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <Rect x={3.5} y={5.5} width={17} height={15} rx={3.5} />
      <Path d="M8 3.5v3.5M16 3.5v3.5M3.5 10.5h17" />
    </G>
  ),
  clock: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={12} cy={12} r={8.2} />
      <Path d="M12 7.5V12l3.2 2" />
    </G>
  ),
  cam: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3.5 8.8A2.3 2.3 0 0 1 5.8 6.5h1.7l1.3-2h6.4l1.3 2h1.7a2.3 2.3 0 0 1 2.3 2.3v8.4a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3z" />
      <Circle cx={12} cy={13} r={3.4} />
    </G>
  ),
  lock: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <Rect x={5} y={10.5} width={14} height={10} rx={3} />
      <Path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
    </G>
  ),
  shield: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3.2l7 2.6v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9v-6z" />
      <Path d="M9 12l2.2 2.2L15.2 10" />
    </G>
  ),
  share: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 15.5V3.5M8.2 7.2 12 3.4l3.8 3.8" />
      <Path d="M6 12.5H4.5v8h15v-8H18" />
    </G>
  ),
  more: (c) => (
    <G fill={c}>
      <Circle cx={5.5} cy={12} r={1.8} />
      <Circle cx={12} cy={12} r={1.8} />
      <Circle cx={18.5} cy={12} r={1.8} />
    </G>
  ),
  trophy: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7.5 4h9v4.5a4.5 4.5 0 0 1-9 0z" />
      <Path d="M7.5 5.5H5a2.5 2.5 0 0 0 2.5 4.5M16.5 5.5H19a2.5 2.5 0 0 1-2.5 4.5M12 13v3.5M8.5 20h7l-.8-3.5h-5.4z" />
    </G>
  ),
  target: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8}>
      <Circle cx={12} cy={12} r={8.2} />
      <Circle cx={12} cy={12} r={4.4} />
      <Circle cx={12} cy={12} r={1.1} fill={c} />
    </G>
  ),
  bookmark: (c) => <Path d="M6.5 4h11v16.5L12 16l-5.5 4.5z" fill="none" stroke={c} strokeWidth={1.8} strokeLinejoin="round" />,
  // Filled twin of `bookmark`: the saved state is shown by colouring the icon in
  // rather than by changing the word beside it.
  bookmarkOn: (c) => <Path d="M6.5 4h11v16.5L12 16l-5.5 4.5z" fill={c} stroke={c} strokeWidth={1.8} strokeLinejoin="round" />,
  verified: (c) => (
    <G>
      <Path d="M12 2.2l2.5 1.6 3-.2 1 2.8 2.3 1.9-1 2.8 1 2.8-2.3 1.9-1 2.8-3-.2L12 21.8 9.5 20.2l-3 .2-1-2.8L3.2 15.7l1-2.8-1-2.8 2.3-1.9 1-2.8 3 .2z" fill={c} />
      <Path d="M8.4 12.2l2.6 2.6 4.8-5.2" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </G>
  ),
  apple: (c) => (
    <Path
      d="M16.4 12.6c0-2.4 1.9-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.9-1.5-.1-2.8.8-3.5.8s-1.9-.8-3.1-.8C6.8 7.2 5 8.5 5 11.4c0 1.8.7 3.7 1.6 5 .8 1.1 1.5 2 2.5 2s1.4-.6 2.7-.6 1.6.6 2.7.6 1.8-1 2.5-2.1c.6-.9.9-1.7 1-1.8-.1 0-2.6-1-2.6-3.9zM13.9 5.7c.6-.7 1-1.6.9-2.6-.9 0-2 .6-2.6 1.3-.6.6-1 1.6-.9 2.5 1 .1 2-.5 2.6-1.2z"
      fill={c}
    />
  ),
  scale: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <Rect x={3.5} y={4.5} width={17} height={15} rx={3.5} />
      <Path d="M8.5 12a3.5 3.5 0 0 1 7 0" />
      <Path d="M12 12l2.2-2" />
    </G>
  ),
  meal: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <Path d="M6 3.5v7a2.5 2.5 0 0 0 5 0v-7M8.5 13v7.5" />
      <Path d="M16.5 3.5c2 0 2.5 2.5 2.5 5s-1 3.5-2.5 3.5S14 10.5 14 8.5s.5-5 2.5-5zM16.5 12v8.5" />
    </G>
  ),
  timer: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <Path d="M9.5 2.8h5" />
      <Circle cx={12} cy={13.5} r={7.5} />
      <Path d="M12 9.8v3.7l2.5 1.5" />
    </G>
  ),
  video: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round">
      <Rect x={3} y={6} width={12.5} height={12} rx={3} />
      <Path d="M15.5 11l5.5-3v8l-5.5-3z" />
    </G>
  ),
  grid: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8}>
      <Rect x={3.5} y={3.5} width={7} height={7} rx={2} />
      <Rect x={13.5} y={3.5} width={7} height={7} rx={2} />
      <Rect x={3.5} y={13.5} width={7} height={7} rx={2} />
      <Rect x={13.5} y={13.5} width={7} height={7} rx={2} />
    </G>
  ),
  edit: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M16.5 4.5l3 3-10 10-4 1 1-4z" />
      <Path d="M4.5 20.5h15" />
    </G>
  ),
  qr: (c) => (
    <G fill="none" stroke={c} strokeWidth={1.8}>
      <Path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
      <Path d="M7.5 12h9" strokeLinecap="round" />
    </G>
  ),
  arrowU: (c) => <Path d="M12 20V5m-5.5 5.5L12 4.5l5.5 6" fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />,
};

export function Icon({
  name,
  size = 24,
  color = '#0B0B0E',
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths[name](color)}
    </Svg>
  );
}
