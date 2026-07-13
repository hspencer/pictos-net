import React, { useEffect, useState } from 'react';

const isDev = (import.meta as any).env?.DEV;

interface IdentityUser {
    email: string;
    user_metadata?: { full_name?: string; avatar_url?: string };
    identities?: Array<{ provider: string; identity_data?: Record<string, string> }>;
    jwt: () => Promise<string>;
}

/**
 * Extract the profile photo URL from wherever GoTrue stored it.
 * GoTrue/Netlify Identity places it in different fields depending on
 * whether the account was created via OAuth or email, and which version
 * of the GoTrue daemon is running:
 *   1. user_metadata.avatar_url  — standard Google OAuth signup path
 *   2. identities[].identity_data.avatar_url — raw OAuth provider data
 *   3. identities[].identity_data.picture    — alternate Google field name
 */
function resolveAvatarUrl(user: any): string | undefined {
    const meta = user?.user_metadata;
    if (meta?.avatar_url) return meta.avatar_url;
    const identities: any[] = user?.identities ?? [];
    for (const id of identities) {
        const d = id?.identity_data;
        if (d?.avatar_url) return d.avatar_url;
        if (d?.picture) return d.picture;
    }
    return undefined;
}

/** Normalize raw GoTrue user, ensuring avatar_url is always in user_metadata. */
function normalizeUser(raw: any): IdentityUser | null {
    if (!raw) return null;
    const avatar_url = resolveAvatarUrl(raw);
    return {
        ...raw,
        user_metadata: { ...raw.user_metadata, avatar_url },
    };
}

interface IdentityWidget {
    init: (opts?: any) => void;
    open: (tab?: string) => void;
    close: () => void;
    currentUser: () => IdentityUser | null;
    logout: () => void;
    on: (event: string, callback: (user?: IdentityUser) => void) => void;
}

let _widget: IdentityWidget | null = null;
let _initPromise: Promise<IdentityWidget> | null = null;

/** Lazily load and init the widget (singleton). */
export async function ensureWidget(): Promise<IdentityWidget> {
    if (_widget) return _widget;
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        const mod = await import('netlify-identity-widget');
        _widget = mod.default as unknown as IdentityWidget;
        _widget.init();
        return _widget;
    })();
    return _initPromise;
}

/** Get current user (may be null). */
export function getCurrentUser(): IdentityUser | null {
    return _widget?.currentUser?.() ?? null;
}

/** Trigger logout. */
export function logout(): void {
    _widget?.logout();
}

type LoginListener = (user: IdentityUser) => void;
const _loginListeners: LoginListener[] = [];

/** Subscribe to login events. Returns an unsubscribe function. */
export function onLogin(listener: LoginListener): () => void {
    _loginListeners.push(listener);
    return () => {
        const idx = _loginListeners.indexOf(listener);
        if (idx >= 0) _loginListeners.splice(idx, 1);
    };
}

function _notifyLogin(user: IdentityUser) {
    _loginListeners.forEach(fn => fn(user));
}

/**
 * Start login and return a Promise that resolves with the user.
 *
 * Google-only auth: the widget's own login modal is not used because its
 * email/password signup path is unsupported (confirmation emails proved
 * unreliable) and the modal cannot be customised to hide it. Instead we
 * navigate straight to GoTrue's external-provider flow. The page unloads;
 * on return, widget.init() consumes the #access_token hash and fires
 * 'login', so AuthProvider restores the session on the fresh page load —
 * the returned Promise intentionally never settles in that case.
 */
export function requestLogin(): Promise<IdentityUser> {
    return new Promise(async (resolve) => {
        const widget = await ensureWidget();
        const current = widget.currentUser();
        if (current) { resolve(current); return; }
        window.location.assign(`${window.location.origin}/.netlify/identity/authorize?provider=google`);
    });
}

/**
 * Garantiza que haya una sesión activa antes de llamar a la API.
 * - En dev: no-op (siempre pasa).
 * - En prod: si no hay sesión, abre el widget y espera login.
 *   Lanza error si el usuario cancela — el caller debe manejar el catch.
 */
export async function ensureAuth(): Promise<void> {
    if (isDev) return;
    await requestLogin();
}

interface AuthProviderProps {
    children: React.ReactNode;
    onUserChange?: (user: IdentityUser | null) => void;
}

/**
 * AuthProvider — initializes the Identity widget in the background.
 * Does NOT block rendering. The app is always accessible.
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children, onUserChange }) => {
    useEffect(() => {
        if (isDev) return;

        ensureWidget().then(widget => {
            // Notify parent of initial state
            const current = normalizeUser(widget.currentUser());
            onUserChange?.(current);

            widget.on('login', (u) => {
                widget.close();
                const normalized = normalizeUser(u ?? null);
                onUserChange?.(normalized);
                if (normalized) _notifyLogin(normalized);
            });
            widget.on('logout', () => {
                onUserChange?.(null);
            });
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <>{children}</>;
};
