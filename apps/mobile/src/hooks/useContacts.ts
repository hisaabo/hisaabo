import * as Contacts from "expo-contacts";
import { useEffect, useState, useCallback } from "react";

export interface PhoneContact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

type PermissionStatus = "undetermined" | "granted" | "denied";

export function useContacts() {
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [permission, setPermission] = useState<PermissionStatus>("undetermined");

  const loadContacts = useCallback(async () => {
    const { data } = await Contacts.getContactsAsync({
      fields: [
        Contacts.Fields.PhoneNumbers,
        Contacts.Fields.Emails,
        Contacts.Fields.Name,
      ],
      sort: Contacts.SortTypes.FirstName,
    });

    const mapped: PhoneContact[] = data
      .filter((c) => c.name)
      .map((c) => ({
        id: c.id!,
        name: c.name!,
        phone:
          c.phoneNumbers?.[0]?.number?.replace(/\s/g, "") || undefined,
        email: c.emails?.[0]?.email || undefined,
      }));

    setContacts(mapped);
  }, []);

  const requestAccess = useCallback(async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    const resolved = status === "granted" ? "granted" : "denied";
    setPermission(resolved);
    if (resolved === "granted") {
      await loadContacts();
    }
  }, [loadContacts]);

  useEffect(() => {
    Contacts.getPermissionsAsync().then(({ status }) => {
      if (status === "granted") {
        setPermission("granted");
        loadContacts();
      } else if (status === "denied") {
        setPermission("denied");
      } else {
        setPermission("undetermined");
      }
    });
  }, [loadContacts]);

  return { contacts, permission, requestAccess };
}
