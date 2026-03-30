import React from "react";
import { Text } from "ink";
import { Spinner as InkSpinner } from "@inkjs/ui";

interface Props {
  label?: string;
}

export function Spinner({ label = "Loading..." }: Props) {
  return (
    <InkSpinner label={label} />
  );
}
