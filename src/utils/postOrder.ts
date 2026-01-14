/**
 * Order Execution Module
 * Re-exports from refactored order system for backwards compatibility
 *
 * @deprecated Import directly from './orders' for new code
 */

import postOrder from './orders';
export * from './orders';
export default postOrder;
