export function buildDecisionTree(rules: any[]): any {
    const root: any = { tests: {} };

    for (const rule of rules) {
        const path = extractConditions(rule.predicate_json);
        insertRule(root, path, rule.route_name);
    }

    return root;
}

function extractConditions(predicate: any): any[] {
    // Flatten into sequence of conditions for tree grouping
    if (!predicate) return [];
    if (predicate.and) {
        return predicate.and.flatMap(extractConditions);
    } else if (predicate.or) {
        // OR means we duplicate paths
        return [{ or: predicate.or.map(extractConditions) }];
    } else {
        // Leaf condition
        return [predicate];
    }
}

function insertRule(node: any, conditions: any[], route: string) {
    if (!conditions.length) {
        node.route = route;
        return;
    }

    const cond = conditions[0];
    const rest = conditions.slice(1);

    if (cond.or) {
        for (const alt of cond.or) {
            insertRule(node, alt.concat(rest), route);
        }
        return;
    }

    const key = JSON.stringify(cond);
    if (!node.tests[key]) node.tests[key] = { tests: {} };
    insertRule(node.tests[key], rest, route);
}

export function generateFunctionFromTree(node: any, depth = 1): string {
    const indent = "  ".repeat(depth);
    let code = "";

    for (const [condKey, child] of Object.entries(node.tests)) {
        const cond = JSON.parse(condKey);
        const expr = conditionToExpr(cond);
        code += `${indent}if (${expr}) {\n`;
        code += generateFunctionFromTree(child, depth + 1);
        code += `${indent}}\n`;
    }

    if (node.route) {
        code += `${indent}return ${JSON.stringify(node.route)};\n`;
    }

    return code;
}

function conditionToExpr(cond: any): string {
    const field = `message.${cond.field}`;
    const op = cond.op;
    const val = typeof cond.value === "string"
        ? JSON.stringify(cond.value)
        : cond.value;
    return `${field} ${op} ${val}`;
}
