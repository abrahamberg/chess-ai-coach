import { z } from 'zod';

export const CreditPackSchema = z.enum(['small', 'medium', 'large']);
export type CreditPack = z.infer<typeof CreditPackSchema>;

/** Credits granted per one-time Stripe Checkout pack purchase. */
export const CREDIT_PACK_CREDITS: Record<CreditPack, number> = {
  small: 300,
  medium: 1000,
  large: 3000
};

export const CreateCheckoutSessionRequestSchema = z.object({
  pack: CreditPackSchema
});
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequestSchema>;

export const CreateCheckoutSessionResponseSchema = z.object({
  url: z.string()
});
export type CreateCheckoutSessionResponse = z.infer<typeof CreateCheckoutSessionResponseSchema>;
