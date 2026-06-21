import { ValidationContext, ASTVisitor, GraphQLError } from 'graphql';

export function depthLimitRule(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    let depth = 0;
    return {
      Field: {
        enter() {
          depth++;
          if (depth > maxDepth) {
            context.reportError(
              new GraphQLError(`Query depth exceeds maximum allowed depth of ${maxDepth}`)
            );
          }
        },
        leave() {
          depth--;
        }
      }
    };
  };
}
