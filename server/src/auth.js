import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { getDatabase } from './db.js';
import { HttpError } from './errors.js';

const router = Router();
const credentials = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
});

function tokenFor(user) {
  return jwt.sign({ sub: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function setToken(response, user) {
  response.cookie('task_keeper_session', tokenFor(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

router.post('/register', authLimiter, async (request, response) => {
  const input = credentials.parse(request.body);
  const user = {
    _id: randomUUID(),
    email: input.email,
    passwordHash: await bcrypt.hash(input.password, 12),
    notificationPreferences: {
      inAppEnabled: true,
      systemEnabled: true,
      emailEnabled: true,
    },
    createdAt: new Date(),
  };

  try {
    await getDatabase().collection('users').insertOne(user);
  } catch (error) {
    if (error.code === 11000) throw new HttpError(409, 'An account with this email already exists');
    throw error;
  }

  setToken(response, user);
  return response.status(201).json({ user: { id: user._id, email: user.email } });
});

router.post('/login', authLimiter, async (request, response) => {
  const input = credentials.parse(request.body);
  const user = await getDatabase().collection('users').findOne({ email: input.email });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  setToken(response, user);
  return response.json({ user: { id: user._id, email: user.email } });
});

router.post('/logout', (_request, response) => {
  response.clearCookie('task_keeper_session', { httpOnly: true, sameSite: 'lax', path: '/' });
  return response.status(204).end();
});

export async function requireAuth(request, _response, next) {
  const token = request.cookies?.task_keeper_session;
  if (!token) return next(new HttpError(401, 'Sign in to continue'));
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    request.user = { id: claims.sub, email: claims.email };
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return next(new HttpError(401, 'Your session has expired; sign in again'));
    }
    return next(error);
  }
}

router.get('/me', requireAuth, (request, response) => response.json({ user: request.user }));

export default router;
