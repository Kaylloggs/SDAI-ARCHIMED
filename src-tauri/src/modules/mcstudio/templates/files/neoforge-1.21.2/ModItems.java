package {{package}}.registry;

import {{package}}.{{main_class}};
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

public final class ModItems {
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems({{main_class}}.MOD_ID);

    // @mcstudio:items (Mod Studio adds new items above this line)

    private ModItems() {}

    /** Since 1.21.2 an item must know its registry key before it is built. */
    private static DeferredItem<Item> registerItem(String name) {
        return ITEMS.register(name, id -> new Item(new Item.Properties().setId(ResourceKey.create(Registries.ITEM, id))));
    }

    public static void addCreative(BuildCreativeModeTabContentsEvent event) {
        if (event.getTabKey() == CreativeModeTabs.INGREDIENTS) {
            // @mcstudio:creative-tab
        }
    }
}
