export type RulePayload = {
    name: string;
    priority: number;
    predicate_json: unknown;
    route_name: string;
    enabled?: boolean;
};
