import { RoutingMessage } from "./RoutingMessage.ts";

export type PartnerMessage = RoutingMessage & {
    partner_name: string;
};