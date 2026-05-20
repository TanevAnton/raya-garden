// Custom Sanity input for EUR prices. Renders the default number input,
// then shows the auto-computed BGN equivalent below using the fixed peg
// 1 EUR = 1.95583 BGN (Bulgaria's currency board).
import { Stack, Card, Text } from "@sanity/ui";

const BGN_PER_EUR = 1.95583;

export function EurWithBgnPreview(props) {
  const eur = typeof props.value === "number" ? props.value : null;
  const bgn = eur != null ? (eur * BGN_PER_EUR).toFixed(2) : null;

  return (
    <Stack space={2}>
      {props.renderDefault(props)}
      <Card padding={2} radius={2} tone={bgn ? "primary" : "transparent"} border>
        <Text size={1} muted>
          {bgn ? (
            <>≈ <strong>{bgn} лв</strong> &nbsp;·&nbsp; auto-calculated · 1 € = 1.95583 лв</>
          ) : (
            <>Type a number in € — BGN equivalent will appear here automatically.</>
          )}
        </Text>
      </Card>
    </Stack>
  );
}
