import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** How a cancelled Assignment's words look everywhere (its block, the open Assignment, the Driver's card): struck through and greyed. */
export const cancelledText = 'text-muted-foreground line-through';
