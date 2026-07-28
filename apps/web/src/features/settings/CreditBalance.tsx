import type { ReactNode } from 'react';

export interface CreditBalanceProps {
  balance: number;
}

/** design.md §4.4: Credits section — balance only. Pack cards → Stripe
 * Checkout land with Task 8.1 (no purchase endpoint exists yet). */
export function CreditBalance({ balance }: CreditBalanceProps): ReactNode {
  return (
    <p className="credit-balance">
      <strong>{balance}</strong> credits
    </p>
  );
}
