import { z } from 'zod';
export const registerSchema = z.object({
    firstName: z.string().min(1, 'First name is required').max(50, 'First name must be under 50 characters').trim(),
    lastName: z.string().min(1, 'Last name is required').max(50, 'Last name must be under 50 characters').trim(),
    email: z.string().min(1, 'Email is required').email('Invalid email address').trim().toLowerCase(),
    password: z.string().min(8, 'Password must be at least 8 characters long')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one digit')
        .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});
export const loginSchema = z.object({
    email: z.string().min(1, 'Email is required').email('Invalid email address').trim().toLowerCase(),
    password: z.string().min(1, 'Password is required'),
});
export const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters long')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one digit')
        .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});
//# sourceMappingURL=auth.schemas.js.map