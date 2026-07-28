import { z } from 'zod';

export const CreditPackSchema = z.enum(['small', 'medium', 'large']);
export type CreditPack = z.infer<typeof CreditPackSchema>;
