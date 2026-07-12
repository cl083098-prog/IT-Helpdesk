<?php
// api/sla_helper.php
// -----------------------------------------------------------------------------
// Shared SLA calculation — required by both get_sla.php (preview at submit
// time) and submit_ticket.php (persistence). Because both endpoints run the
// SAME function on the SAME inputs, the preview the requester sees at submit
// time is exactly what gets stored on the ticket. That's the property that
// keeps SLA consistent across every role from the moment a ticket is created.
// -----------------------------------------------------------------------------

if (!function_exists('calculateSlaForTicket')) {

    /**
     * Look up SLA from sla_rules with equipment-keyword-first matching.
     * @return array{priority:string,response_hours:float,resolution_hours:float}
     */
    function lookupSlaRule(PDO $pdo, string $category, string $reqType, string $equipment): array {
        $stmt = $pdo->prepare(
            "SELECT priority, response_hours, resolution_hours FROM sla_rules
             WHERE category = :cat AND request_type = :rt
               AND equipment_keyword IS NOT NULL
               AND :equip LIKE CONCAT('%', equipment_keyword, '%')
             ORDER BY CHAR_LENGTH(equipment_keyword) DESC LIMIT 1"
        );
        $stmt->execute([':cat'=>$category, ':rt'=>$reqType, ':equip'=>$equipment]);
        $rule = $stmt->fetch();
        if ($rule) return $rule;

        $stmt2 = $pdo->prepare(
            "SELECT priority, response_hours, resolution_hours FROM sla_rules
             WHERE category = :cat AND request_type = :rt
               AND equipment_keyword IS NULL LIMIT 1"
        );
        $stmt2->execute([':cat'=>$category, ':rt'=>$reqType]);
        return $stmt2->fetch() ?: [
            'priority' => 'Low', 'response_hours' => 8, 'resolution_hours' => 48
        ];
    }

    /**
     * Check inventory stock for the equipment/item. Returns 'In Stock',
     * 'Low Stock', 'Out of Stock', or 'N/A' if the item isn't tracked.
     */
    function checkStockStatus(PDO $pdo, string $equipment): string {
        if ($equipment === '') return 'N/A';
        try {
            $s = $pdo->prepare(
                "SELECT quantity, low_stock_pct, oversupply_threshold
                 FROM inventory
                 WHERE :q LIKE CONCAT('%', name, '%') OR name LIKE CONCAT('%', :q2, '%')
                 ORDER BY CHAR_LENGTH(name) DESC LIMIT 1"
            );
            $s->execute([':q'=>$equipment, ':q2'=>$equipment]);
            $row = $s->fetch();
            if (!$row) return 'N/A';

            $qty       = (int)$row['quantity'];
            $lowPct    = (int)($row['low_stock_pct']       ?? 20);
            $oversupp  = (int)($row['oversupply_threshold']?? 0);
            $threshold = $oversupp > 0 ? ($lowPct / 100.0) * $oversupp : 0;

            if ($qty <= 0)                             return 'Out of Stock';
            if ($threshold > 0 && $qty <= $threshold)  return 'Low Stock';
            return 'In Stock';
        } catch (PDOException $e) { return 'N/A'; }
    }

    /**
     * Final SLA for a ticket — starts from sla_rules match, then extends
     * for out-of-stock / low-stock consumable & equipment items.
     *
     * @return array{
     *   priority: string,
     *   response_hours: float,
     *   resolution_hours: float,
     *   stock_status: string,       // 'In Stock' | 'Low Stock' | 'Out of Stock' | 'N/A'
     *   sla_extended_reason: ?string,
     *   base_priority: string       // priority before any stock bump
     * }
     */
    function calculateSlaForTicket(PDO $pdo, string $category, string $reqType, string $equipment): array {
        $rule = lookupSlaRule($pdo, $category, $reqType, $equipment);
        $response   = (float)$rule['response_hours'];
        $resolution = (float)$rule['resolution_hours'];
        $priority   = (string)$rule['priority'];
        $basePri    = $priority;

        $stock      = 'N/A';
        $extended   = null;

        // Only apply stock-based extensions to categories that consume items
        if (in_array($category, ['Equipment', 'Consumable'], true) && $equipment !== '') {
            $stock = checkStockStatus($pdo, $equipment);
            if ($stock === 'Out of Stock') {
                $response   *= 2;
                $resolution *= 2;
                if ($priority === 'Low') $priority = 'Medium';
                $extended = 'Item out of stock — SLA extended (procurement required).';
            } elseif ($stock === 'Low Stock') {
                $resolution *= 1.5;
                $extended = 'Item low on stock — SLA extended (allow lead time).';
            }
        }

        return [
            'priority'            => $priority,
            'response_hours'      => $response,
            'resolution_hours'    => $resolution,
            'stock_status'        => $stock,
            'sla_extended_reason' => $extended,
            'base_priority'       => $basePri,
        ];
    }
}
