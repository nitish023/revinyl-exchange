import { loginSchema, registerSchema } from '../../../shared/index.js';
import { authForm } from '../components/authForm.js';
import { h } from '../dom.js';
import { session } from '../session.js';

/** Where to go after logging in: a same-site ?next= path, otherwise search. */
export function nextPath(query) {
  const next = query.get('next') ?? '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/search';
}

/** Log in and sign up are printed as a clip-out coupon, like a 60s subscription form. */
function authLayout(kicker, title, subtitle, form, footer) {
  return h(
    'main',
    { class: 'page auth-page' },
    h(
      'section',
      { class: 'auth-card coupon' },
      h('p', { class: 'kicker' }, kicker),
      h('h1', { class: 'headline' }, title),
      h('p', { class: 'deck' }, subtitle),
      form,
      h('p', { class: 'auth-footer' }, footer),
    ),
  );
}

function redirectIfLoggedIn(ctx) {
  if (!session.user) return false;
  queueMicrotask(() => ctx.navigate(nextPath(ctx.query), { replace: true }));
  return true;
}

export const loginPage = (ctx) => {
  if (redirectIfLoggedIn(ctx)) return h('main');
  document.title = 'Log in | reVINYL';
  const form = authForm({
    schema: loginSchema,
    submitLabel: 'Log in',
    fields: [
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
      { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
    ],
    onSubmit: async (values) => {
      await session.login(values);
      ctx.navigate(nextPath(ctx.query), { replace: true });
    },
  });
  return authLayout(
    'Log in',
    'Welcome back',
    'Pick up where you left off: your crate, your ads, your offers.',
    form,
    h('span', {}, 'New here? ', h('a', { href: '/register' }, 'Create an account')),
  );
};

export const registerPage = (ctx) => {
  if (redirectIfLoggedIn(ctx)) return h('main');
  document.title = 'Sign up | reVINYL';
  const form = authForm({
    schema: registerSchema,
    submitLabel: 'Create account',
    fields: [
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
      {
        name: 'displayName',
        label: 'Display name',
        autocomplete: 'username',
        hint: 'Shown to other traders. Letters, numbers, - and _.',
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        autocomplete: 'new-password',
        hint: 'At least 8 characters.',
      },
    ],
    onSubmit: async (values) => {
      await session.register(values);
      ctx.navigate(nextPath(ctx.query), { replace: true });
    },
  });
  return authLayout(
    'Subscribe',
    'Start your crate',
    'Every account starts with $2,000 in play money for trading records. No real dollars, ever.',
    form,
    h('span', {}, 'Already have an account? ', h('a', { href: '/login' }, 'Log in')),
  );
};
