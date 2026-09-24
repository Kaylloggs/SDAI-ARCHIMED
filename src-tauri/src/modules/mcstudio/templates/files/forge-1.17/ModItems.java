package {{package}}.registry;

import {{package}}.{{main_class}};
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import {{registry_object}};
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;

public final class ModItems {
    public static final DeferredRegister<Item> ITEMS = DeferredRegister.create(ForgeRegistries.ITEMS, {{main_class}}.MOD_ID);

    // @mcstudio:items (Mod Studio adds new items above this line)

    private ModItems() {}
}
