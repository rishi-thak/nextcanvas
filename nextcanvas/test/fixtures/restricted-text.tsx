import React from 'react';
const values = [7, 30];
const members = [{ id: 'member&1', display_name: 'A & <B>', organization: '' }];
function Pass({ children }) { return <>{children}</>; }
export default function Fixture() {
  return <form>
    <select id="dates" defaultValue={30}>
      {values.map(value => <option key={value} value={value}>Last {value} days</option>)}
    </select>
    <select id="members" defaultValue="member&1">
      <option value="">Choose a council member</option>
      {members.map(m => <option key={m.id} value={m.id}>{m.display_name} — {m.organization || "Organization not set"}</option>)}
    </select>
    <select id="shapes" defaultValue="fragment">
      <optgroup label="Labels">
        <option value="static">Tom &amp; Jerry &lt;3</option>
        <option value="bound">{members[0].display_name}</option>
        {members.map(m => <option key={m.id} value="single">{m.display_name}</option>)}
        {members.map(m => <option key={m.id} value="mixed">{m.display_name}{m.organization || 'fallback'}</option>)}
        {values.map(value => <option key={value} value={`template-${value}`}>{`Last ${value} days`}</option>)}
        <option value="fragment"><>Last {values[0]} days</></option>
        <option value="component"><Pass>Last {values[0]} days</Pass></option>
        <option value="named"><React.Fragment><Pass>{members[0].display_name} suffix</Pass></React.Fragment></option>
        <option value="conditional">{true && <Pass>Last {values[0]} days</Pass>}</option>
        <option value="mapped">{values.map(value => <Pass key={value}>Last {value} days</Pass>)}</option>
        <option>Implicit &amp; value</option>
      </optgroup>
    </select>
    <p id="normal">Hello {values.length + 0} readers!</p>
    <Pass>Editable component</Pass>
    <table><tbody><tr><td>Cell {values.length + 0} copy</td></tr></tbody></table>
  </form>;
}
