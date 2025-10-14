import { SubmissionMessage } from "./SubmissionMessage.ts";

export type RoutingMessage = SubmissionMessage & {
    person_id: string;
    alias_id?: string | null;
};
