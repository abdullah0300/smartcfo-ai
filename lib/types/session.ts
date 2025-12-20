// Local session types to replace next-auth types
// Used throughout the app for user session management

export interface User {
    id: string;
    email: string;
    type?: "regular" | "guest";
    name?: string;
    image?: string;
}

export interface Session {
    user: User;
    expires?: string;
}
