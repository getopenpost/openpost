import { useState } from "react";
import { View } from "react-native";
import { BodyText, Button, TextField } from "./ui";
import type { ServerHeader } from "@/lib/server-headers";

export function ProxyHeadersEditor({
  headers,
  onChange,
  disabled = false,
  expanded = false,
}: {
  headers: ServerHeader[];
  onChange: (headers: ServerHeader[]) => void;
  disabled?: boolean;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  function edit(index: number, field: keyof ServerHeader, value: string) {
    onChange(headers.map((header, i) => (i === index ? { ...header, [field]: value } : header)));
  }
  return (
    <View style={{ gap: 12 }}>
      <Button
        title="Advanced: proxy headers"
        intent="quiet"
        accessibilityState={{ expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <>
          <BodyText>
            For servers behind an authenticating proxy. Headers are stored securely on this device
            and sent only to your server.
          </BodyText>
          {headers.map((header, index) => (
            <View key={index} style={{ gap: 8 }}>
              <TextField
                accessibilityLabel={`Header ${index + 1} name`}
                placeholder="Header name"
                value={header.name}
                onChangeText={(value) => edit(index, "name", value)}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!disabled}
              />
              <TextField
                accessibilityLabel={`Header ${index + 1} value`}
                placeholder="Header value"
                value={header.value}
                onChangeText={(value) => edit(index, "value", value)}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!disabled}
              />
              <Button
                title={`Remove header ${index + 1}`}
                intent="quiet"
                disabled={disabled}
                onPress={() => onChange(headers.filter((_, i) => i !== index))}
              />
            </View>
          ))}
          <Button
            title="Add header"
            intent="ordinary"
            disabled={disabled}
            onPress={() => onChange([...headers, { name: "", value: "" }])}
          />
        </>
      ) : null}
    </View>
  );
}
