/**
 * Module Loader for Dynamic Registration
 * Handles loading and registration of physics modules
 */

import { moduleRegistry } from '../../modules/core/module-registry.js';

/**
 * Initialize and register all available physics modules
 */
export async function initializeModules(): Promise<void> {
  try {
    // Register static Casimir module
    const { staticCasimirModule } = await import('../../modules/sim_core/static-casimir.js');
    moduleRegistry.register(staticCasimirModule);
    
    // Register dynamic Casimir module
    const { dynamicCasimirModule } = await import('../../modules/dynamic/dynamic-casimir.js');
    moduleRegistry.register(dynamicCasimirModule);
    
    console.log('Physics modules initialized:', moduleRegistry.getAvailable());
  } catch (error) {
    console.error('Failed to initialize modules:', error);
  }
}

/**
 * Get module instance for calculations
 */
export function getModuleRegistry() {
  return moduleRegistry;
}