// Visibility management - tracks which variables are visible in the current agentic loop

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [VISIBILITY] ${msg}`);
}

export class VisibilityManager {
  private currentLoopVars: Set<string> = new Set(); // Vars created this agentic loop
  private revealedVars: Set<string> = new Set(); // Explicitly revealed vars for this loop

  /**
   * Mark a variable as revealed for this loop
   * @param name Variable name to reveal
   * @param stateHas Function to check if state contains the variable
   * @returns true if the variable was revealed, false if not found
   */
  reveal(name: string, stateHas: (name: string) => boolean): boolean {
    if (stateHas(name)) {
      this.revealedVars.add(name);
      log(`Revealed variable: ${name}`);
      return true;
    }
    log(`Cannot reveal unknown variable: ${name}`);
    return false;
  }

  /**
   * Called when agent yields to user - hide everything
   */
  onYieldToUser(): void {
    log(
      `onYieldToUser: clearing ${this.currentLoopVars.size} currentLoopVars and ${this.revealedVars.size} revealedVars`
    );
    this.currentLoopVars.clear();
    this.revealedVars.clear();
  }

  /**
   * Check if a variable is visible (created this loop or explicitly revealed)
   */
  isVisible(name: string): boolean {
    return this.currentLoopVars.has(name) || this.revealedVars.has(name);
  }

  /**
   * Mark a variable as created in the current loop (makes it visible)
   */
  markCreated(name: string): void {
    this.currentLoopVars.add(name);
  }
}
