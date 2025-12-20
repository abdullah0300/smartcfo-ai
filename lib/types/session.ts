// Local session types to replace next-auth types
// Used throughout the app for user session management

export type UserType = "regular" | "guest";

export interface User {
    id: string;
    email: string;
    type: UserType;
    name?: string;
    image?: string;
}

export interface Session {
    user: User;
    expires?: string;
}
