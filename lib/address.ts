/** A delivery address as the customer builds it: label (Home / Work / Other), text, and an optional pincode. */
export interface DeliveryAddress {
  label: string
  /** Flat / house, area, landmark, city. No pincode. */
  text: string
  pincode: string
}

/** One string for saving to the profile ("... - 575003"). The order itself stores text and pincode separately. */
export const joinAddress = (a: DeliveryAddress) => (a.pincode ? `${a.text} - ${a.pincode}` : a.text)

/** Reverse of joinAddress. Older saved addresses may have no pincode. */
export function parseAddress(raw: string, label = ''): DeliveryAddress {
  const m = raw.trim().match(/^([\s\S]*?)[\s,-]*(\d{6})$/)
  return m ? { label, text: m[1].trim(), pincode: m[2] } : { label, text: raw.trim(), pincode: '' }
}
