/** Same sign-in methods on the local demo store and the Supabase store. */

export function withAuth(layer) {
  layer.auth = {
    session: () => layer.request({ method: 'GET', path: '/api/auth/me' }),
    signUp: (body) => layer.request({ method: 'POST', path: '/api/auth/signup', body }),
    signIn: (body) => layer.request({ method: 'POST', path: '/api/auth/login', body }),
    signInWithMagicLink: (body) => layer.request({ method: 'POST', path: '/api/auth/magic', body }),
    sendPhoneOtp: (body) => layer.request({ method: 'POST', path: '/api/auth/phone', body }),
    verifyPhoneOtp: (body) => layer.request({ method: 'POST', path: '/api/auth/phone/verify', body }),
    signOut: () => layer.request({ method: 'POST', path: '/api/auth/logout', body: {} }),
    updateProfile: (body) => layer.request({ method: 'PATCH', path: '/api/auth/profile', body }),
  };
  return layer;
}
