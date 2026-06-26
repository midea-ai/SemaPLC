import { ContactNode } from './ContactNode'
import { CoilNode } from './CoilNode'
import { TimerNode } from './TimerNode'
import { CounterNode } from './CounterNode'
import { ComparatorNode } from './ComparatorNode'
import { PowerRailNode } from './PowerRailNode'
import './LadderNodes.css'

// Map for React Flow's nodeTypes prop. Keys must match LadderElementType strings
// produced by the transformer (see src/models/ladder-elements.ts).
export const ladderNodeTypes = {
  contact: ContactNode,
  coil: CoilNode,
  timer: TimerNode,
  counter: CounterNode,
  comparator: ComparatorNode,
  powerRail: PowerRailNode,
}
