export type SubmissionMessage = {
    email?: string | null;
    full_name?: string | null;
    phone?: string | null;
    payload?: Record<string, unknown>;
};
